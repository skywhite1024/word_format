export type Mode = "auto" | "official" | "thesis";

export type BlockType = "heading" | "paragraph" | "reference" | "formula";

export interface Block {
  type: BlockType;
  text: string;
  level: number;
}

export interface StructuredDoc {
  mode: Exclude<Mode, "auto">;
  title: string;
  blocks: Block[];
  stats: {
    paragraphCount: number;
    headingCount: number;
    referenceCount: number;
  };
}
