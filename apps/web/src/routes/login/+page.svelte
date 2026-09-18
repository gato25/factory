<script lang="ts">
  import { enhance } from '$app/forms';
  // From `shared`, NOT from `$lib/services/auth`: that module imports
  // `node:crypto` for the session cookie, and importing it here pulled
  // `node:crypto` into the browser bundle and killed this page at runtime.
  import { MIN_PASSWORD_LENGTH } from '@factory/shared';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  const NAMES = { gitlab: 'GitLab', github: 'GitHub' } as const;

  /**
   * A failed round trip comes back as a code in the query string, and a code
   * is not something to show a person. The ones this application produces get
   * a sentence; anything the provider sent back in its own words is shown as
   * it arrived, because a provider's reason is more use than our guess at it.
   */
  const PROBLEMS: Record<string, string> = {
    'unknown-provider': 'Тийм үйлчилгээ байхгүй байна.',
    'bad-state': 'Нэвтрэх оролдлого баталгаажсангүй. Дахин эхнээс нь оролдоно уу.',
    'gitlab-not-configured': 'GitLab-аар нэвтрэх тохиргоо хийгдээгүй байна.',
    'github-not-configured': 'GitHub-аар нэвтрэх тохиргоо хийгдээгүй байна.',
    access_denied: 'Нэвтрэх зөвшөөрлийг цуцаллаа.',
  };
  const problem = $derived(
    data.problem ? (PROBLEMS[data.problem] ?? data.problem) : null,
  );

  // The pipeline as main describes it: design is conditional on the ticket
  // changing the interface (FR-099, FR-032b).
  const flow = [
    'Даалгавар',
    'Тодорхойлолт',
    'Дизайн?',
    'Төлөвлөгөө',
    'Даалгаврууд',
    'Хөгжүүлэлт',
    'Нэгтгэх хүсэлт',
  ];
</script>

<div class="split">
  <section class="pitch">
    <h1>Code Factory</h1>
    <p class="one-liner">Даалгавраас хянаж болох нэгтгэх хүсэлт болгоно.</p>
    <ol class="flow">
      {#each flow as step, i (step)}
        <li class:conditional={step.endsWith('?')}>
          {step.replace('?', '')}
          {#if i < flow.length - 1}<span aria-hidden="true">→</span>{/if}
        </li>
      {/each}
    </ol>
    <p class="note">Дизайн алхам зөвхөн интерфейс өөрчилдөг даалгавар дээр ажиллана.</p>
  </section>

  <!--
    One screen, two states. On a deployment nobody has an account on there is
    nothing to sign in to, so it asks for the first account instead — and that
    account is the administrator. Before this, the only way in was hand-written
    SQL against the database.
  -->
  <section class="signin">
    <h2>{data.needsFirstAccount ? 'Эхний бүртгэл үүсгэх' : 'Нэвтрэх'}</h2>
    {#if problem}
      <p class="error" role="alert">{problem}</p>
    {/if}

    {#if data.needsFirstAccount}
      <p class="lede">
        Энд хараахан хэн ч бүртгэлгүй байна. Эхний бүртгэл нь администратор болно — холболтыг
        тохируулж, нууц түлхүүрүүдийг хадгалж, бусдыг урьж чадна.
      </p>
      <form method="POST" action="?/register" use:enhance>
        <label>
          Таны нэр
          <input name="name" type="text" autocomplete="name" placeholder="Заавал биш" />
        </label>
        <label>
          И-мэйл
          <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
        </label>
        <label>
          Нууц үг
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            minlength={MIN_PASSWORD_LENGTH}
            required
          />
          <span class="hint">
            Хамгийн багадаа {MIN_PASSWORD_LENGTH} тэмдэгт — энэ бүртгэл хадгалагдсан бүх нууц
            түлхүүрийг уншиж чадна.
          </span>
        </label>
        {#if form?.message}
          <p class="error" role="alert">{form.message}</p>
        {/if}
        <button type="submit">Бүртгэл үүсгээд нэвтрэх</button>
      </form>
    {:else}
      {#if data.providers.length > 0}
        <div class="providers">
          {#each data.providers as provider (provider)}
            <a class="provider" href="/login/{provider}">{NAMES[provider]}-ээр үргэлжлүүлэх</a>
          {/each}
        </div>
        <div class="or"><span>эсвэл</span></div>
      {/if}
      <form method="POST" action="?/password" use:enhance>
        <label>
          И-мэйл
          <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
        </label>
        <label>
          Нууц үг
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        {#if form?.message}
          <p class="error" role="alert">{form.message}</p>
        {/if}
        <button type="submit">Нэвтрэх</button>
      </form>
      <p class="note">
        Бүртгэлгүй юу? Администратор тань урих эсвэл холбогдсон үйлчилгээгээр нэвтэрнэ үү.
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
