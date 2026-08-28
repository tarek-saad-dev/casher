import type {
  GenerateConversationTurnInput,
  GenerateConversationTurnOutput,
} from '../domain/types';

export type AiModelClient = {
  generateConversationTurn(
    input: GenerateConversationTurnInput,
  ): Promise<GenerateConversationTurnOutput>;
};
