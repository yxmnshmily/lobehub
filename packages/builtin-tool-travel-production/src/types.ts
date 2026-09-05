export const TravelProductionApiName = {
  generateCopy: 'generateCopy',
  generateDocument: 'generateDocument',
  generateImage: 'generateImage',
  generateVideo: 'generateVideo',
} as const;

export interface GenerateTravelCopyParams {
  prompt: string;
}

export interface GenerateTravelDocumentParams {
  prompt: string;
  title?: string;
}

export interface GenerateTravelImageParams {
  imageNum?: number;
  prompt: string;
}

export interface GenerateTravelVideoParams {
  prompt: string;
}
