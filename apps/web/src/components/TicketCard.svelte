<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import StepBar from '$components/StepBar.svelte';
  import { pipelineName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import type { BoardTicket } from '$lib/services/run-view';
  import { stateWords } from '$lib/state-words';

  /**
   * One board card, built to artboard 04's Card: the reference and the
   * author on one row, the title, the repository and pipeline, then the step
   * bar of the ticket's OWN pipeline and its state in words (FR-018).
   *
   * The state line is the point of the card: whether this ticket needs you.
   * It is in words as well as colour (FR-006), and a long title, repository or
   * pipeline truncates with the whole of it on hover rather than pushing the
   * bar or the state out of the card.
   */
  let { ticket, now = Date.now() }: { ticket: BoardTicket; now?: number } = $props();

  const initials = $derived(
    (ticket.createdByName ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );
  const meta = $derived(
    `${ticket.repository}${ticket.pipeline ? ` · ${pipelineName(ticket.pipeline)}` : ''}`,
  );
  const state = $derived(stateWords(ticket.state, 'card', now));
</script>

<a class="ticket" href="/tickets/{ticket.id}" data-ticket={ticket.id}>
  <span class="top">
    <span class="id">{ticket.reference}</span>
    <span
      class="who"
      title={m.ticketCard.createdBy(ticket.createdByName ?? m.ticketCard.unknown)}
      aria-label={m.ticketCard.createdBy(ticket.createdByName ?? m.ticketCard.unknown)}
      >{initials}</span
    >
  </span>

  <span class="title" title={ticket.title}>{ticket.title}</span>

  <span class="meta">
    <Icon name="folder-git-2" size={12} />
    <span class="meta-text" title={meta}>{meta}</span>
  </span>

  <span class="status">
    <StepBar shape={ticket.steps} size="sm" />
    <span class="line {state.tone}" class:live={state.live}>
      <span class="dot" aria-hidden="true"></span>
      <span class="line-text" title={state.text}>{state.text}</span>
    </span>
  </span>
</a>

<style>
  .ticket {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid transparent;
    border-radius: var(--r-lg);
    text-decoration: none;
    color: inherit;
    background:
      linear-gradient(180deg, #fffffff2, #ffffffe6) padding-box,
      linear-gradient(180deg, var(--highlight), #ffffff00) border-box;
    box-shadow: 0 6px 14px var(--shadow-depth);
  }
  .ticket:hover {
    box-shadow:
      0 0 0 2px var(--accent-soft),
      0 6px 14px var(--shadow-depth);
  }
  .ticket:hover .title {
    text-decoration: underline;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .id {
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--text-3);
  }
  .who {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-pill);
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 700;
    color: #5a2a0a;
    background: linear-gradient(180deg, #ffc9a3, #f59a5b);
  }

  .title {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-3);
  }
  .meta :global(svg) {
    flex: none;
  }
  .meta-text,
  .line-text {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-text {
    font-size: var(--type-caption);
    color: var(--text-2);
  }

  .status {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: var(--r-pill);
    background: var(--text-3);
  }
  .run {
    color: var(--accent-text);
  }
  .run .dot {
    background: var(--accent);
  }
  .pen {
    color: var(--pen-text);
  }
  .pen .dot {
    background: var(--purple);
  }
  .wait {
    color: var(--warning-text);
  }
  .wait .dot {
    background: #d9a200;
  }
  .done {
    color: var(--success-text);
  }
  .done .dot {
    background: var(--success);
  }
  .fail {
    color: var(--danger-text);
  }
  .fail .dot {
    background: var(--red-to);
  }
  .live .dot {
    box-shadow: 0 0 6px var(--glow-accent);
  }
</style>
