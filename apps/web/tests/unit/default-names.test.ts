import { describe, expect, test } from 'bun:test';
import {
  agentDescription,
  agentName,
  pipelineDescription,
  pipelineName,
  runningPhrase,
  SHIPPED_AGENTS,
  SHIPPED_PIPELINES,
  stepName,
} from '../../src/lib/default-names';
import { catalogueFor } from '../../src/lib/i18n';
import { DEFAULT_AGENTS } from '../../src/lib/services/agent-defaults';
import { DEFAULT_PIPELINES } from '../../src/lib/services/pipeline-defaults';

/**
 * FR-028: the shipped defaults are shown in the deployment's language; any
 * other name is shown as given; nothing is renamed.
 */

const mn = catalogueFor('mn');
const en = catalogueFor('en');

describe('the list of shipped names is the list the product ships', () => {
  test('agents', () => {
    expect(Object.keys(SHIPPED_AGENTS).sort()).toEqual(DEFAULT_AGENTS.map((a) => a.name).sort());
    for (const agent of DEFAULT_AGENTS) {
      expect(SHIPPED_AGENTS[agent.name as keyof typeof SHIPPED_AGENTS]).toBe(agent.slug as never);
      // A still-shipped description is translated, so the stored text must match it.
      expect(agentDescription(agent.name, agent.description, en)).toBe(agent.description);
      expect(agentDescription(agent.name, agent.description, mn)).not.toBe(agent.description);
    }
  });

  test('pipelines', () => {
    expect(Object.keys(SHIPPED_PIPELINES).sort()).toEqual(
      DEFAULT_PIPELINES.map((p) => p.name).sort(),
    );
    for (const pipeline of DEFAULT_PIPELINES) {
      expect(pipelineDescription(pipeline.name, pipeline.description, mn)).not.toBe(
        pipeline.description,
      );
    }
  });
});

describe('a shipped default reads in the catalogue', () => {
  test('in Mongolian, as the design draws it', () => {
    expect(agentName('Spec', mn)).toBe('Тодорхойлолт агент');
    expect(stepName('Implement', mn)).toBe('Хөгжүүлэлт');
    expect(stepName('Design', mn)).toBe('Дизайн · pen.dev');
    expect(runningPhrase('Implement', 'agent', mn)).toBe('Хөгжүүлж байна');
    expect(runningPhrase('Design', 'design', mn)).toBe('pen.dev дээр зурж байна');
    expect(pipelineName('Standard', mn)).toBe('Стандарт');
    expect(pipelineName('Review-heavy', mn)).toBe('Хяналттай');
  });

  test('in English, as shipped', () => {
    expect(agentName('Spec', en)).toBe('Spec');
    expect(pipelineName('Quick fix', en)).toBe('Quick fix');
  });
});

describe('a name somebody gave is shown as given', () => {
  test('a custom agent keeps its name, and runs under it', () => {
    expect(agentName('Аюулгүй байдлын хяналт', mn)).toBe('Аюулгүй байдлын хяналт');
    expect(stepName('Security review', mn)).toBe('Security review');
    expect(runningPhrase('Security review', 'agent', mn)).toBe('Security review ажиллаж байна');
  });

  test('a custom design agent still says it is drawing', () => {
    expect(runningPhrase('Brand designer', 'design', mn)).toBe('pen.dev дээр зурж байна');
  });

  test('a renamed default, or a near miss, is not translated', () => {
    expect(agentName('spec', mn)).toBe('spec');
    expect(pipelineName('Standard (copy)', mn)).toBe('Standard (copy)');
  });

  test('a rewritten description is theirs', () => {
    expect(agentDescription('Spec', 'Our own words.', mn)).toBe('Our own words.');
    expect(pipelineDescription('Standard', null, mn)).toBeNull();
  });
});
