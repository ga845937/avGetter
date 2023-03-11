import { Browser, Page } from "puppeteer";
import { Socket } from "socket.io";

export interface IChData {
    chapterName: string,
    chioceChapterIndex: number,
    mp4Url: string,
    tsLength: number,
    downloadLength: number,
    tsPath: string,
    finalName: string
}

export interface IGetJableTS {
    unixTimestamp: number,
    bname: string,
    chData: IChData,
    socket: Socket
}

export interface IJable {
    avUrl: string,
    listDownload: boolean,
    videoUrlIndex: number,
    videoUrl?: string,
    browser?: Browser,
    page?: Page,
    bname?: string,
    chList?: string[][],
    chData?: IChData[],
    downloadEndIndx: number[],
    mergeEndIndx: number[]
}

export interface IDownloadInfo {
    unixTimestamp: number,
    bname: string,
    chapterName: string,
    chioceChapterIndex: number,
    tsLength: number,
    downloadLength: number,
    compeleteTask: boolean
}
