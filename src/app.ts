import { httpPort } from "./config.json";
import { createServer } from "http";
import express from "express";
import cookieParser from "cookie-parser";
import { Server as socketServer } from "socket.io";
import { join } from "path";
import { indexRouter } from "./routes/index";
import { indexWS } from "./ws/indexWS";

const app = express();
const httpServer = createServer(app);
indexWS(new socketServer(httpServer, { path: "/avGetter" }));

app.set("views", join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use("/avGetterPublic", express.static(join(__dirname, "public")));

app.use("/avGetter", indexRouter.router);

httpServer.listen(httpPort);
