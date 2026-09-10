<script lang="ts">
  import type { Step, StepCondition } from '@factory/shared';
  import { CONDITION_DESCRIPTION } from '@factory/shared';
  import { STEP_KIND_LABEL } from '$lib/services/pipeline';

  /**
   * What each kind of step can declare (FR-032): an agent step its required
   * documents, a review gate who may approve it, how long it waits and what
   * happens when that time expires.
   */
  let {
    step,
    index,
    agents = [],
    members = [],
    onChange
  }: {
    step: Step;
    index: number;
    agents: { id: string; name: string; engine: string; model: string }[];
    members: { id: string; name: string }[];
    onChange: (step: Step) => void;
  } = $props();

  const CONDITIONS: StepCondition[] = ['always', 'ticket_has_ui', 'ticket_has_no_ui'];
  const conditionLabel = (c: StepCondition) => CONDITION_DESCRIPTION[c] ?? 'always';

  /** Only agents on the matching engine can run this kind of step (FR-036b). */
  const usable = $derived(
    agents.filter((agent) =>
      step.type === 'design' ? agent.engine === 'design_cli' : agent.engine === 'claude_cli'
    )
  );

  const approverMode = $derived(
    Array.isArray(step.approvers) ? 'named' : (step.approvers ?? 'anyone')
  );

  const patch = (fields: Partial<Step>) => onChange({ ...step, ...fields });

  function setApproverMode(mode: string) {
    if (mode === 'named') patch({ approvers: [] });
    else patch({ approvers: mode as 'anyone' | 'ticket_creator' });
  }

  function toggleApprover(id: string, on: boolean) {
    const current = Array.isArray(step.approvers) ? step.approvers : [];
    patch({ approvers: on ? [...current, id] : current.filter((x) => x !== id) });
  }
</script>

<section class="card editor">
  <h2 class="section">Step {index + 1} — {STEP_KIND_LABEL[step.type]}</h2>

  <!-- Every step carries a condition, defaulting to always (FR-032a, FR-032b) -->
  <label>
    <span class="small muted">When does this step run?</span>
    <select
      value={step.condition}
      onchange={(e) => patch({ condition: e.currentTarget.value as StepCondition })}
    >
      {#each CONDITIONS as condition (condition)}
        <option value={condition}>{conditionLabel(condition)}</option>
      {/each}
    </select>
  </label>

  {#if step.type === 'agent' || step.type === 'design'}
    <label>
      <span class="small muted">Agent</span>
      <select value={step.agent_id ?? ''} onchange={(e) => patch({ agent_id: e.currentTarget.value })}>
        <option value="">Choose an agent…</option>
        {#each usable as agent (agent.id)}
          <option value={agent.id}>{agent.name} — {agent.model}</option>
        {/each}
      </select>
    </label>
    {#if usable.length === 0}
      <p class="hint small warn-text">
        No agent runs on the engine this step needs. Create one first.
      </p>
    {/if}
  {/if}

  {#if step.type === 'agent'}
    <label>
      <span class="small muted">Documents this step must produce, one per line</span>
      <textarea
        rows="3"
        placeholder="docs/spec.md"
        value={(step.output_files ?? []).join('\n')}
        oninput={(e) =>
          patch({
            output_files: e.currentTarget.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          })}
      ></textarea>
    </label>
    <p class="hint small muted">
      Leave this empty for the step that writes the code. A step with required documents fails if
      it does not produce them.
    </p>
  {/if}

  {#if step.type === 'design'}
    <label>
      <span class="small muted">Design source path</span>
      <input
        value={step.design?.source_path ?? 'docs/design/ui.pen'}
        oninput={(e) =>
          patch({
            design: {
              export_dir: 'docs/design/screens',
              export_scale: 2,
              ...step.design,
              source_path: e.currentTarget.value
            }
          })}
      />
    </label>
    <label>
      <span class="small muted">Where the screens are exported</span>
      <input
        value={step.design?.export_dir ?? 'docs/design/screens'}
        oninput={(e) =>
          patch({
            design: {
              source_path: 'docs/design/ui.pen',
              export_scale: 2,
              ...step.design,
              export_dir: e.currentTarget.value
            }
          })}
      />
    </label>
  {/if}

  {#if step.type === 'checkpoint'}
    <!-- Who may approve, how long it waits, what expiry does (FR-032) -->
    <label>
      <span class="small muted">Who may decide this checkpoint?</span>
      <select value={approverMode} onchange={(e) => setApproverMode(e.currentTarget.value)}>
        <option value="anyone">Anyone in the workspace</option>
        <option value="ticket_creator">The ticket's author</option>
        <option value="named">Only the people I name</option>
      </select>
    </label>
    {#if approverMode === 'named'}
      <fieldset>
        <legend class="small muted">Approvers</legend>
        {#each members as member (member.id)}
          <label class="inline">
            <input
              type="checkbox"
              checked={Array.isArray(step.approvers) && step.approvers.includes(member.id)}
              onchange={(e) => toggleApprover(member.id, e.currentTarget.checked)}
            />
            {member.name}
          </label>
        {/each}
        {#if Array.isArray(step.approvers) && step.approvers.length === 0}
          <p class="hint small warn-text">
            Nobody is named, so nobody could ever decide this checkpoint.
          </p>
        {/if}
      </fieldset>
    {/if}
    <label>
      <span class="small muted">How long it waits, in hours</span>
      <input
        type="number"
        min="1"
        placeholder="indefinitely"
        value={step.timeout_hours ?? ''}
        oninput={(e) =>
          patch({
            timeout_hours: e.currentTarget.value ? Number(e.currentTarget.value) : undefined
          })}
      />
    </label>
    <p class="hint small muted">Leave empty to wait until somebody decides.</p>
    {#if step.timeout_hours}
      <label>
        <span class="small muted">When that time expires</span>
        <select
          value={step.on_timeout ?? 'wait'}
          onchange={(e) =>
            patch({ on_timeout: e.currentTarget.value as 'wait' | 'continue' | 'fail' })}
        >
          <option value="wait">Keep waiting anyway</option>
          <option value="continue">Continue as if approved</option>
          <option value="fail">Fail the run</option>
        </select>
      </label>
    {/if}
  {/if}

  {#if step.type === 'shell'}
    <label>
      <span class="small muted">Command</span>
      <input
        placeholder="bun test"
        value={step.command ?? ''}
        oninput={(e) => patch({ command: e.currentTarget.value })}
      />
    </label>
    <p class="hint small muted">
      This is the only way a pipeline verifies anything. A non-zero exit fails the run.
    </p>
  {/if}

  {#if step.type === 'notify'}
    <label>
      <span class="small muted">Channel</span>
      <input
        placeholder="#code-factory"
        value={step.channel ?? ''}
        oninput={(e) => patch({ channel: e.currentTarget.value })}
      />
    </label>
    <label>
      <span class="small muted">Message</span>
      <textarea
        rows="2"
        placeholder="{'{{ticket.id}}'} reached step {index + 1}"
        value={step.template ?? ''}
        oninput={(e) => patch({ template: e.currentTarget.value })}
      ></textarea>
    </label>
  {/if}
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label.inline {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px 10px;
  }
  legend { padding: 0 4px; }
  input,
  select,
  textarea {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .hint {
    margin: -6px 0 0;
  }
  .warn-text { color: #8a6100; }
</style>
