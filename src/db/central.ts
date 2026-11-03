import { SQL } from "bun";
import { config } from "../config";

export const central = new SQL({ ...config.database, max: 10 });
