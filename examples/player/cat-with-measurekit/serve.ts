import { demoServer } from "./src/demo-server.ts";
import { listen } from "./src/listen.ts";

const ADDRESS = "127.0.0.1";
const [, , port = "8080"] = process.argv;

const { url } = await listen(demoServer(), Number(port), ADDRESS);
console.log(`The engine listens on ${url}/ims/cat/v1p0, and the token endpoint on ${url}/oauth2/token.`);
