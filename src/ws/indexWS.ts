import { Server, Socket } from "socket.io";
import { Task, IavRequest, IDownloadRequest } from "../model/avRequest";

import { newJable } from "../services/jable";
import { ttlMinute } from "../config.json";

interface TaskQueue {
    [key: string]: { [key: string]: Task }
}
const taskQueue: TaskQueue = {};

export const indexWS = function (io: Server) {
    try {
        io.on("connection", (socket) => {
            socket.on("getChList", async (avRequest: IavRequest) => {
                if (!taskQueue[socket.id]) {
                    taskQueue[socket.id] = {};
                }
                const unixTimestamp = +new Date();
                const task = genTask(socket, avRequest, unixTimestamp);
                taskQueue[socket.id][unixTimestamp] = task;
                await task.getChList();
            });

            socket.on("download", async (downloadRequest: IDownloadRequest) => {
                try {
                    const task = taskQueue[socket.id][downloadRequest.unixTimestamp];
                    await task.preDownload(downloadRequest.chioceChapterIndex);
                    task.download();
                }
                catch (err) {
                    console.log(err);

                }
            });

            socket.on("deleteTask", async (unixTimestamp: number) => {
                const task = taskQueue[socket.id][unixTimestamp];
                if (task) {
                    delete taskQueue[socket.id][unixTimestamp];
                }
            });

            socket.on("batchWork", async (req: IavRequest[]) => {
                if (!taskQueue[socket.id]) {
                    taskQueue[socket.id] = {};
                }
                for (let i = 0; i < req.length; i++) {
                    const unixTimestamp = +new Date() + i;
                    const task = genTask(socket, req[i], unixTimestamp);
                    taskQueue[socket.id][unixTimestamp] = task;
                    task.batchWork();
                }
                socket.emit("sendBatch");
            });

            socket.on("updateTTL", async (unixTimestamp: number) => {
                const task = taskQueue[socket.id][unixTimestamp];
                task.ttl += (ttlMinute * 60 * 1000);
            });
        });
    }
    catch (err) {
        console.log(err);
    }
};

function genTask(socket: Socket, avRequest: IavRequest, unixTimestamp: number): Task {
    switch (avRequest.avWeb) {
        case "jable":
            return newJable(socket, avRequest.avUrl, unixTimestamp);
        default:
            throw new Error("網站選擇錯誤");
    }
}

function checkSocketAlive() {
    const taskQueueSocketId = Object.keys(taskQueue);
    for (const socketId of taskQueueSocketId) {
        const socketIdTask = Object.values(taskQueue[socketId]) as Task[];
        for (const task of socketIdTask) {
            if (+ new Date() > task.ttl) {
                delete taskQueue[socketId][task.unixTimestamp];
            }
        }
    }
}

setInterval(checkSocketAlive, (Math.ceil(ttlMinute / 2) * 60 * 1000));
