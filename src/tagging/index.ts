import { config } from "../config.js";
import { NoneTagger, type Tagger } from "./tagger.js";
import { BedrockTagger } from "./bedrockTagger.js";

let singleton: Tagger | undefined;

export function getTagger(): Tagger {
  singleton ??= config.taggingProvider === "bedrock" ? new BedrockTagger() : new NoneTagger();
  return singleton;
}

export type { Tagger, GarmentTag } from "./tagger.js";
