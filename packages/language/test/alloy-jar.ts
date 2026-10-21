import * as fs from "node:fs";
import * as path from "node:path";

/** The jar the extension ships, fetched by its build (`npm run build` or `npm run fetch:alloy -w packages/extension`). */
export const shippedJar = path.resolve(__dirname, "../../extension/alloy/alloy.jar");

/**
 * The Alloy jar the tests run: ALLOY_JAR when set, to try another version,
 * else the shipped jar. Undefined when neither exists; jar tests then skip.
 */
export const testJar = [process.env.ALLOY_JAR, shippedJar]
    .find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));
