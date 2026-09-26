export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  searchQueries?: string[];
  sources?: GroundingSource[];
  searchNotice?: string;
  isError?: boolean;
}

export interface ChatResponsePayload {
  text: string;
  searchQueries?: string[];
  sources?: GroundingSource[];
  searchNotice?: string;
  error?: string;
}
