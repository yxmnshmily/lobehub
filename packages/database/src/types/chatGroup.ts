export interface ChatGroupConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  memberSlots?: Array<{
    agentId?: string;
    configurable: boolean;
    key: string;
    label: string;
    role: 'participant' | 'supervisor';
    skillSlots?: string[];
    status?: 'configured' | 'unconfigured';
  }>;
  openingMessage?: string;
  openingQuestions?: string[];
  revealDM?: boolean;
  systemPrompt?: string;
}
