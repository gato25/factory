<script lang="ts">
  import { enhance } from '$app/forms';
  // From `shared`, NOT from `$lib/services/auth`: that module imports
  // `node:crypto` for the session cookie, and importing it here pulled
  // `node:crypto` into the browser bundle and killed this page at runtime.
  import { MIN_PASSWORD_LENGTH } from '@factory/shared';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  const NAMES = { gitlab: 'GitLab', github: 'GitHub' } as const;

  // The pipeline as main describes it: design is conditional on the ticket
  // changing the interface (FR-099, FR-032b).
  const flow = ['Ticket', 'Spec', 'Design?', 'Plan', 'Tasks', 'Implement', 'MR'];
</script>

<div class="split">
  <section class="pitch">
    <h1>Code Factory</h1>
    <p class="one-liner">Turn a ticket into a reviewable merge request.</p>
    <ol class="flow">
      {#each flow as step, i (step)}
        <li class:conditional={step.endsWith('?')}>
          {step.replace('?', '')}
          {#if i < flow.length - 1}<span aria-hidden="true">→</span>{/if}
        </li>
      {/each}
    </ol>
    <p class="note">Design runs only when a ticket changes the interface.</p>
  </section>

  <!--
    One screen, two states. On a deployment nobody has an account on there is
    nothing to sign in to, so it asks for the first account instead — and that
    account is the administrator. Before this, the only way in was hand-written
    SQL against the database.
  -->
  <section class="signin">
    <h2>{data.needsFirstAccount ? 'Create the first account' : 'Sign in'}</h2>
    {#if data.problem}
      <p class="error" role="alert">{data.problem}</p>
    {/if}

    {#if data.needsFirstAccount}
      <p class="lede">
        Nobody has an account here yet. This first one is the administrator — it can set the
        connections, store credentials and invite everybody else.
      </p>
      <form method="POST" action="?/register" use:enhance>
        <label>
          Your name
          <input name="name" type="text" autocomplete="name" placeholder="Optional" />
        </label>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            minlength={MIN_PASSWORD_LENGTH}
            required
          />
          <span class="hint">
            At least {MIN_PASSWORD_LENGTH} characters — this account can read every stored credential.
          </span>
        </label>
        {#if form?.message}
          <p class="error" role="alert">{form.message}</p>
        {/if}
        <button type="submit">Create account and sign in</button>
      </form>
    {:else}
      {#if data.providers.length > 0}
        <div class="providers">
          {#each data.providers as provider (provider)}
            <a class="provider" href="/login/{provider}">Continue with {NAMES[provider]}</a>
          {/each}
        </div>
        <div class="or"><span>or</span></div>
      {/if}
      <form method="POST" action="?/password" use:enhance>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        {#if form?.message}
          <p class="error" role="alert">{form.message}</p>
        {/if}
        <button type="submit">Sign in</button>
      </form>
      <p class="note">
        No account? An administrator invites you, or sign in with a connected provider.
      </p>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    font: 14px/1.5 system-ui, sans-serif;
    color: #1a1d24;
  }
  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 100vh;
  }
  .pitch {
    background: #1a1d24;
    color: #fff;
    padding: 48px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  .one-liner {
    font-size: 18px;
    color: #c9cedb;
    margin: 0;
  }
  .flow {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 0;
    margin: 16px 0 0;
  }
  .flow li {
    display: flex;
    gap: 10px;
    align-items: center;
    color: #eef1f7;
  }
  .flow li.conditional {
    color: #9aa3b8;
    font-style: italic;
  }
  .note {
    color: #9aa3b8;
    font-size: 13px;
    margin: 0;
  }
  .signin {
    padding: 48px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    max-width: 380px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .lede {
    margin: 0 0 4px;
    font-size: 13px;
    line-height: 1.5;
    opacity: 0.75;
  }
  .hint {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    opacity: 0.6;
  }
  .providers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .provider {
    padding: 10px 14px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    text-decoration: none;
    color: inherit;
    text-align: center;
    font-weight: 500;
  }
  .or {
    display: flex;
    align-items: center;
    color: #6b7280;
    font-size: 12px;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e3e6ec;
  }
  .or span {
    padding: 0 10px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: #4a5060;
  }
  input {
    padding: 9px 10px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    font: inherit;
  }
  .error {
    margin: 0;
    color: #b3261e;
    font-size: 13px;
  }
  button {
    padding: 10px 14px;
    border: 0;
    border-radius: 6px;
    background: #3d5afe;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  @media (max-width: 860px) {
    .split {
      grid-template-columns: 1fr;
    }
    .pitch {
      padding: 32px;
    }
    .signin {
      padding: 32px;
      max-width: none;
    }
  }
</style>
