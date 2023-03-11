import { Jable } from "../services/jable";

export type Task = Jable;

export interface IavRequest {
    avWeb: "jable",
    avUrl: string,
    downloadEnd?: boolean
}

export interface IDownloadRequest {
    unixTimestamp: number,
    chioceChapterIndex: number[],
}
