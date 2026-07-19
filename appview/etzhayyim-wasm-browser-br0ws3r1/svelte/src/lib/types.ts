export interface SparkSection {
  title: string;
  content: string;
}

export type SearchEvent =
  | { type: 'phase'; phase: string }
  | { type: 'source'; url: string }
  | { type: 'section'; title: string }
  | { type: 'token'; token: string };
