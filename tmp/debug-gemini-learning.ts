#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const { interpretLearningSubmission } = await import(
    '../src/modules/ai-control-plane/application/learningInterpreter'
  );
  const inputs = [
    'متقولش يا باشا',
    'لما العميل يكون محتار بين اختيارين متضغطش عليه، وضح الفرق وسيبه يقرر',
  ];
  for (const raw of inputs) {
    console.log('\n=== INPUT ===', raw);
    try {
      const r = await interpretLearningSubmission(raw, { engine: 'gemini', allowHeuristicFallback: false });
      console.log('engine', r.interpreterEngine, 'model', r.modelName);
      console.log('artifacts', r.proposedArtifacts.length);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error('ERR', e);
    }
  }
}

main();
