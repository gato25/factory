<script lang="ts">
  import '../../app.css';
  import { enhance } from '$app/forms';
  // From `shared`, NOT from `$lib/services/auth`: that module imports
  // `node:crypto` for the session cookie, and importing it here pulled
  // `node:crypto` into the browser bundle and killed this page at runtime.
  import { MIN_PASSWORD_LENGTH } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import type { ActionData, PageData } from './$types';

  /**
   * 00 Login, built to its artboard: a hero tile that says what the product
   * does and draws the flow — with the design step, the point of it, lit up —
   * and a sign-in tile (specs/004-bento-redesign).
   *
   * The artboard also floats two figures over the hero, a first-attempt rate
   * and a finished design review. They are not drawn: before anyone has
   * signed in, a number there is either invented or the workspace's own
   * record shown to a stranger (the fidelity check records the omission).
   */
  let { form, data }: { form: ActionData; data: PageData } = $props();

  const NAMES = { gitlab: 'GitLab', github: 'GitHub' } as const;
  const flow = m.login.flow;
  const year = new Date().getFullYear();
</script>

<div class="login">
  <section class="hero" aria-labelledby="hero-title">
    <span class="glow one" aria-hidden="true"></span>
    <span class="glow two" aria-hidden="true"></span>

    <div class="brand">
      <span class="mark" aria-hidden="true"><Icon name="factory" size={20} /></span>
      <span class="name">{m.app.name}</span>
    </div>

    <div class="mid">
      <h1 id="hero-title">{m.login.headline}</h1>
      <p class="lede">{m.login.oneLiner}</p>
      <ol class="flow" aria-label={m.login.flowLabel}>
        {#each flow as step, i (step)}
          <li>
            <span class="step" class:design={step === m.login.flowDesign}>{step}</span>
            {#if i < flow.length - 1}
              <span class="arrow" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
            {/if}
          </li>
        {/each}
      </ol>
    </div>

    <p class="foot">{m.login.foot(year)}</p>
  </section>

  <!--
    One screen, two states. On a deployment nobody has an account on there is
    nothing to sign in to, so it asks for the first account instead — and that
    account is the administrator. Before this, the only way in was hand-written
    SQL against the database.
  -->
  <div class="side">
    <section class="tile signin">
      <header>
        <h2>{data.needsFirstAccount ? m.login.createFirstAccount : m.login.signIn}</h2>
        <p>{data.needsFirstAccount ? m.login.firstAccountLede : m.login.signInLede}</p>
      </header>

      {#if data.problem}
        <p class="error" role="alert">{data.problem}</p>
      {/if}

      {#if data.needsFirstAccount}
        <form method="POST" action="?/register" use:enhance>
          <label class="field">
            <span class="label">{m.login.yourName}</span>
            <input name="name" type="text" autocomplete="name" placeholder={m.login.optional} />
          </label>
          <label class="field">
            <span class="label">{m.login.email}</span>
            <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
          </label>
          <label class="field">
            <span class="label">{m.login.password}</span>
            <input
              name="password"
              type="password"
              autocomplete="new-password"
              minlength={MIN_PASSWORD_LENGTH}
              required
            />
            <span class="hint">{m.login.passwordHint(MIN_PASSWORD_LENGTH)}</span>
          </label>
          {#if form?.message}
            <p class="error" role="alert">{form.message}</p>
          {/if}
          <button class="btn submit" type="submit">
            {m.login.createAccountAndSignIn}
            <Icon name="arrow-right" size={16} />
          </button>
        </form>
      {:else}
        {#if data.providers.length > 0}
          <div class="providers">
            {#each data.providers as provider (provider)}
              <a class="provider" href="/login/{provider}">
                <span class="orb-sq {provider}" aria-hidden="true"><Icon name={provider} size={15} /></span>
                <span class="label">{m.login.continueWith(NAMES[provider])}</span>
                <span class="go" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>
              </a>
            {/each}
          </div>
          <div class="or"><span>{m.login.or}</span></div>
        {/if}
        <form method="POST" action="?/password" use:enhance>
          <label class="field">
            <span class="label">{m.login.email}</span>
            <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
          </label>
          <label class="field">
            <span class="label">{m.login.password}</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          {#if form?.message}
            <p class="error" role="alert">{form.message}</p>
          {/if}
          <button class="btn submit" type="submit">
            {m.login.signIn}
            <Icon name="arrow-right" size={16} />
          </button>
        </form>
        <p class="note">{m.login.signInNote}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  /* The artboard: a 28px gutter, the hero taking what the 560px sign-in
     column leaves. */
  .login {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 560px;
    gap: 20px;
    min-height: 100vh;
    padding: 28px;
  }

  .hero {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--space-8);
    padding: 48px;
    overflow: hidden;
    border-radius: 28px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-deep-from), var(--accent-deep-to));
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
  }
  /* Two soft lights on the tile, as the artboard draws them; behind the
     words, never under them at full strength. */
  .glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }
  .glow.one {
    top: -120px;
    right: -96px;
    width: 520px;
    height: 520px;
    background: radial-gradient(circle, #ffc9a380, #ffc9a300 70%);
  }
  .glow.two {
    bottom: -150px;
    left: -120px;
    width: 420px;
    height: 420px;
    background: radial-gradient(circle, #f59a5b66, #f59a5b00 70%);
  }
  .brand,
  .mid,
  .foot {
    position: relative;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 1px solid #ffffff55;
    border-radius: 12px;
    background: #ffffff33;
  }
  .name {
    font: 700 20px / 1.2 var(--font-head);
    letter-spacing: -0.3px;
  }

  .mid {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 708px;
  }
  h1 {
    max-width: 620px;
    margin: 0;
    font: 700 44px / 1.1 var(--font-head);
    letter-spacing: -1.2px;
  }
  .lede {
    max-width: 600px;
    margin: 0;
    font-size: 16px;
    line-height: 1.55;
  }

  .flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .flow li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .step {
    padding: 7px 12px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 600;
    background: #00000024;
  }
  .step.design {
    color: var(--accent-text);
    background: var(--surface);
  }
  .arrow {
    display: grid;
    color: #f4c8a8;
  }

  .foot {
    margin: 0;
    font-size: var(--type-caption);
  }

  .side {
    display: grid;
    place-items: center;
  }
  .signin {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 440px;
    max-width: 100%;
    padding: 36px;
    border-radius: 28px;
  }
  header {
    display: grid;
    gap: 6px;
    padding-bottom: 6px;
  }
  h2 {
    margin: 0;
    font: 700 30px / 1.2 var(--font-head);
    letter-spacing: -0.8px;
    color: var(--text);
  }
  header p {
    margin: 0;
    color: var(--text-2);
  }

  .providers {
    display: grid;
    gap: var(--space-4);
  }
  .provider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 10px 14px;
    border-radius: var(--r-md);
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    background: var(--surface-2);
  }
  .provider:hover {
    background: var(--accent-soft);
  }
  .provider .label {
    flex: 1;
  }
  .orb-sq {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    color: var(--text-inv);
  }
  .orb-sq.gitlab {
    background: linear-gradient(180deg, #ffb38a, #e8683a);
  }
  .orb-sq.github {
    background: linear-gradient(180deg, #b9b2a9, #6a635a);
  }
  .go {
    display: grid;
    color: var(--text-3);
  }

  .or {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 4px 0;
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .field {
    gap: 7px;
  }
  .submit {
    width: 100%;
    padding: 13px 16px;
    border-radius: var(--r-md);
    font-size: 15px;
    font-weight: 700;
  }

  .note {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .error {
    margin: 0;
    font-weight: 600;
    color: var(--danger-text);
  }

  @media (max-width: 1100px) {
    .login {
      grid-template-columns: 1fr;
    }
    .hero {
      padding: 32px;
    }
    h1 {
      font-size: 34px;
    }
  }
</style>
