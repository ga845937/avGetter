import { IChData, IGetJableTS, IJable, IDownloadInfo } from "../model/jable";
import { delay, fetchRetry, streamDownloadFile, streamDownloadFileWithDecipher, errorHandle } from "./utils";
import config from "../config.json";

import { launch } from "puppeteer";
import { Socket } from "socket.io";
import { mkdirSync, existsSync, writeFileSync, statSync, rmSync } from "fs";
import { join } from "path";
import { createDecipheriv } from "crypto";
import ffmpeg from "fluent-ffmpeg";

export class Jable {
    socket: Socket;
    unixTimestamp: number;
    ttl: number;
    data: IJable;
    m3u8Url: string;
    constructor(socket: Socket, avUrl: string, unixTimestamp: number) {
        this.socket = socket;
        this.unixTimestamp = unixTimestamp;
        this.ttl = unixTimestamp + (config.ttlMinute * 60 * 1000);
        this.data = {
            avUrl: avUrl,
            listDownload: avUrl.startsWith(config.jable.modelUrlStart),
            videoUrlIndex: 0,
            chList: [],
            chData: [],
            downloadEndIndx: [],
            mergeEndIndx: []
        };
    }

    async getChList() {
        try {
            const jable = this.data;
            jable.browser = await launch({
                // headless: false,
                args: ["--no-sandbox"],
                ignoreHTTPSErrors: true
            });

            jable.page = await jable.browser.newPage();
            jable.page.setRequestInterception(true);
            jable.page.on("request", request => {
                const url = request.url();
                if (!url.includes("jable")) {
                    return request.abort();
                }
                request.continue();
            });

            await jable.page.setExtraHTTPHeaders(config.jable.headers);
            await jable.page.goto(jable.avUrl);
            const bnameDom = await jable.page.title();
            if (jable.listDownload) {
                jable.bname = bnameDom.split("出演的AV在線看")[0].replace(/([<>:"/\\|?*])/g, "");

                const [videoLength] = await jable.page.$$eval(".inactive-color ", anchors => anchors.map(a => parseInt(a.textContent.replace(" 部影片", ""))));
                const videoPage = Array.from({ length: Math.ceil(videoLength / 24) }, (num, i) => (i + 1).toString().padStart(2, "0"));

                for (const btnWord of videoPage) {
                    if (btnWord !== "01") {
                        const button = await jable.page.$x(`//a[contains(text(), '${btnWord}')]`) as any;
                        await button.at(-1).click();
                        await delay(1000);
                    }

                    const chList = await jable.page.$$eval(".video-img-box .detail .title > a", anchors => anchors.map(a => [a.textContent, a.getAttribute("href")]));
                    jable.chList = jable.chList.concat(chList);
                }
            }
            else {
                jable.bname = bnameDom.split(" - Jable.TV")[0].replace(/([<>:"/\\|?*])/g, "");
                jable.chList = [[jable.bname, jable.avUrl]];
            }

            if (jable.chList.length === 0) {
                errorHandle(this, new Error("沒有可下載的影片..."));
            }
            const chListRes = {
                ttlMinute: config.ttlMinute,
                unixTimestamp: this.unixTimestamp,
                chList: jable.chList
            };
            this.socket.emit("sendChList", chListRes);
        }
        catch (err) {
            errorHandle(this, err);
        }
    }

    async preDownload(chioceChapterIndex: number[]) {
        try {
            this.socket.emit("status", "建立資料夾中...");
            const jable = this.data;

            for (const chapterIndex of chioceChapterIndex) {
                const chapterName = jable.chList[chapterIndex][0];
                const tsPath = join(config.rootDir, jable.bname, chapterName.split(" ")[0]);
                const finalName = join(config.rootDir, jable.bname, `${chapterName}.mp4`);
                if (existsSync(tsPath) || existsSync(finalName)) {
                    this.socket.emit("status", `${jable.bname} - ${chapterName} 已存在`);
                    continue;
                }

                const chDataJSON: IChData = {
                    chapterName: chapterName,
                    chioceChapterIndex: chapterIndex,
                    mp4Url: jable.chList[chapterIndex][1],
                    tsLength: 0,
                    downloadLength: 0,
                    tsPath: tsPath,
                    finalName: finalName
                };
                jable.chData.push(chDataJSON);
            }

            if (jable.chData.length > 0) {
                this.socket.emit("status", "下載中...");
            }
            else {
                errorHandle(this, new Error("沒有可下載的影片..."));
            }
        }
        catch (err) {
            errorHandle(this, err);
        }
    }

    async download() {
        try {
            const jable = this.data;
            const videoPage = await jable.browser.newPage();
            await videoPage.setRequestInterception(true);
            videoPage.on("request", request => {
                const url = request.url();
                if (!this.m3u8Url && url.endsWith(".m3u8")) {
                    this.m3u8Url = url;
                }
                request.continue();
            });

            await videoPage.setExtraHTTPHeaders(config.jable.headers);

            for (const chData of jable.chData) {
                this.m3u8Url = null;
                await videoPage.goto(chData.mp4Url);

                await mkdirSync(chData.tsPath, { recursive: true });
                const [coverUrl] = await videoPage.$eval("#player", video => [video.getAttribute("poster")]);
                const coverRequest = await fetchRetry(coverUrl);
                const coverPath = join(config.rootDir, jable.bname, chData.chapterName + ".jpg");
                await streamDownloadFile(coverPath, coverRequest.body);

                let retry = 1;
                while (!this.m3u8Url) {
                    this.socket.emit("status", `第${retry}次重試抓取 ${chData.finalName} 的m3u8`);
                    await delay();
                    retry++;
                    if (retry > 5) {
                        this.socket.emit("status", `${chData.finalName} 重整頁面`);
                        retry = 0;
                        await videoPage.reload();
                    }
                }

                const getMyselfTSData: IGetJableTS = {
                    unixTimestamp: this.unixTimestamp,
                    bname: jable.bname,
                    chData: chData,
                    socket: this.socket
                };
                await this.getJableTS(getMyselfTSData);
                const mergeEndIndx = jable.mergeEndIndx;
                await mergeTS(chData.tsPath, chData.finalName, mergeEndIndx, chData.chioceChapterIndex);

                while (!mergeEndIndx.includes(chData.chioceChapterIndex)) {
                    this.socket.emit("status", `${jable.bname} - ${chData.chapterName} 合併中`);
                    await delay(30000);
                }
                await rmSync(chData.tsPath, { recursive: true, force: true });
                this.m3u8Url = null;

                const downloadInfoRes: IDownloadInfo = {
                    unixTimestamp: this.unixTimestamp,
                    bname: jable.bname,
                    chioceChapterIndex: chData.chioceChapterIndex,
                    chapterName: chData.chapterName,
                    tsLength: chData.tsLength,
                    downloadLength: chData.downloadLength,
                    compeleteTask: jable.chData.length === jable.mergeEndIndx.length
                };
                this.socket.emit("mergeEnd", downloadInfoRes);
            }
            await jable.browser.close();
        }
        catch (err) {
            errorHandle(this, err);
            throw err;
        }
    }

    async getJableTS(getJableTSData: IGetJableTS) {
        const { unixTimestamp, bname, chData, socket } = getJableTSData;
        const m3u8Request = await fetchRetry(this.m3u8Url);
        const m3u8Txt = await m3u8Request.text();
        writeFileSync(join(chData.tsPath, "index.m3u8"), m3u8Txt);

        const m3u8BaseUrl = this.m3u8Url.replace(this.m3u8Url.split("/").pop(), "");
        const tsUrl = m3u8Txt.split("\n").filter((x: string) => x.endsWith(".ts")).map((x: string) => m3u8BaseUrl + x);
        chData.tsLength = tsUrl.length;
        chData.downloadLength = 0;

        const m3u8Encode = m3u8Txt.split("\n").find((x: string) => x.includes("EXT-X-KEY"));
        let m3u8URI, m3u8IV, m3u8KeyRequest, m3u8Key;
        if (m3u8Encode) {
            const m3u8EncodeData = m3u8Encode.split(",");
            m3u8URI = m3u8EncodeData[1].split("\"")[1];
            m3u8IV = m3u8EncodeData[2].split("=")[1].replace("0x", "").substr(0, 16);
            m3u8KeyRequest = await fetchRetry(m3u8BaseUrl + m3u8URI, { headers: config.jable.headers });
            m3u8Key = await m3u8KeyRequest.arrayBuffer() as any;

            writeFileSync(join(chData.tsPath, "oriIndex.m3u8"), m3u8Txt);
            const m3u8WithoutKey = m3u8Txt.split("\n").filter((x: string) => !x.includes("EXT-X-KEY")).join("\n");
            writeFileSync(join(chData.tsPath, "index.m3u8"), m3u8WithoutKey);
        }

        for (const tsN of tsUrl) {
            const tsName = tsN.split("/").at(-1);
            const tsFilePath = join(chData.tsPath, tsName);

            const tsRequest = await fetchRetry(tsN, { headers: config.jable.headers });
            if (m3u8URI) {
                const decipher = createDecipheriv("aes-128-cbc", m3u8Key, m3u8IV);
                await streamDownloadFileWithDecipher(tsFilePath, tsRequest.body, decipher);
            }
            else {
                await streamDownloadFile(tsFilePath, tsRequest.body);
            }

            // 檔案小於10kb 就重新下載一次
            const size = Math.ceil((await statSync(tsFilePath)).size / 1024);
            if (size < 10) {
                await delay();
                const tsRequest = await fetchRetry(tsN, { headers: config.jable.headers });
                if (m3u8URI) {
                    const decipher = createDecipheriv("aes-128-cbc", m3u8Key, m3u8IV);
                    await streamDownloadFileWithDecipher(tsFilePath, tsRequest.body, decipher);
                }
                else {
                    await streamDownloadFile(tsFilePath, tsRequest.body);
                }
            }

            chData.downloadLength++;
            const downloadInfoRes: IDownloadInfo = {
                unixTimestamp: unixTimestamp,
                bname: bname,
                chioceChapterIndex: chData.chioceChapterIndex,
                chapterName: chData.chapterName,
                tsLength: chData.tsLength,
                downloadLength: chData.downloadLength,
                compeleteTask: false
            };

            socket.emit("downloadEnd", downloadInfoRes);
        }
        await delay(); // 等檔案真的放完在硬碟
        return;
    }

    async batchWork() {
        try {
            const jable = this.data;
            await this.getChList();
            const chioceChapterIndex = Array.from({ length: jable.chList.length }, (num, i) => i);
            this.socket.emit("status", "建立資料夾中...");
            await this.preDownload(chioceChapterIndex);
            await this.download();
        }
        catch (err) {
            console.log(err);
        }

    }
}

async function mergeTS(tsPath: string, finalName: string, mergeEndIndx: number[], chioceChapterIndex: number) {
    ffmpeg(join(tsPath, "index.m3u8"))
        // .on("progress", (progress) => {
        //     console.log("Processing: " + progress.percent + "% done");
        // })
        .on("error", (err: Error) => {
            throw err;
        })
        .on("end", () => {
            mergeEndIndx.push(chioceChapterIndex);
        })
        .outputOptions("-c copy")
        .outputOptions("-bsf:a aac_adtstoasc")
        .output(finalName)
        .run();
}

export function newJable(socket: Socket, avUrl: string, unixTimestamp: number) {
    return new Jable(socket, avUrl, unixTimestamp);
}
