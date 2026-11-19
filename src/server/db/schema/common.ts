import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/uuid";

export const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
export const tz = (name: string) => timestamp(name, { withTimezone: true });
