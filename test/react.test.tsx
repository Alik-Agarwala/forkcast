// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createForkcast } from '../src/core/client';
import type { Experiment as Exp } from '../src/core/types';
import { mountDevtools } from '../src/devtools';
import { Experiment, Feature, ForkcastProvider, useTreatment, Variant } from '../src/react';

const experiments: Exp[] = [
  {
    key: 'new-checkout',
    name: 'New checkout',
    type: 'experiment',
    variants: [
      { key: 'C', weight: 50 },
      { key: 'T1', weight: 50 },
    ],
    environments: { development: { status: 'off', traffic: 100 } },
  },
  {
    key: 'dark-mode',
    name: 'Dark mode',
    type: 'flag',
    variants: [
      { key: 'C', weight: 0 },
      { key: 'T1', weight: 100 },
    ],
    environments: { development: { status: 'launched', traffic: 100, launchedVariant: 'T1' } },
  },
];

function Label() {
  return <span data-testid="label">{useTreatment('new-checkout')}</span>;
}

afterEach(() => cleanup());

describe('React bindings', () => {
  it('renders the matching <Variant> and re-renders on override', () => {
    const client = createForkcast({ config: experiments, devMode: true, user: { id: 'u1' }, persist: false });
    render(
      <ForkcastProvider client={client}>
        <Experiment name="new-checkout">
          <Variant name="C"><p>old checkout</p></Variant>
          <Variant name="T1"><p>one-click checkout</p></Variant>
        </Experiment>
        <Feature flag="dark-mode" fallback={<p>light</p>}><p>dark</p></Feature>
        <Label />
      </ForkcastProvider>,
    );
    expect(screen.getByText('old checkout')).toBeTruthy();
    expect(screen.getByText('dark')).toBeTruthy();
    expect(screen.getByTestId('label').textContent).toBe('C');

    act(() => client.override('new-checkout', 'T1'));
    expect(screen.getByText('one-click checkout')).toBeTruthy();
    expect(screen.getByTestId('label').textContent).toBe('T1');

    act(() => client.override('dark-mode', 'C'));
    expect(screen.getByText('light')).toBeTruthy();
  });

  it('falls back to the C branch for unknown treatments', () => {
    const client = createForkcast({ config: experiments, devMode: true, user: { id: 'u1' }, persist: false });
    render(
      <ForkcastProvider client={client}>
        <Experiment name="missing">
          <Variant name="C">control</Variant>
          <Variant name="T1">treatment</Variant>
        </Experiment>
      </ForkcastProvider>,
    );
    expect(screen.getByText('control')).toBeTruthy();
  });
});

describe('devtools', () => {
  it('mounts in dev mode and lets you override a treatment', () => {
    const client = createForkcast({ config: experiments, devMode: true, user: { id: 'u1' }, persist: false });
    const unmount = mountDevtools(client, { open: true });
    const host = document.querySelector('[data-forkcast-devtools]')!;
    const select = host.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Treatment for new-checkout"]')!;
    select.value = 'T1';
    select.dispatchEvent(new Event('change'));
    expect(client.getTreatment('new-checkout')).toBe('T1');
    unmount();
    expect(document.querySelector('[data-forkcast-devtools]')).toBeNull();
  });

  it('does not mount in production builds', () => {
    const client = createForkcast({ config: experiments, devMode: false, persist: false });
    mountDevtools(client);
    expect(document.querySelector('[data-forkcast-devtools]')).toBeNull();
  });
});
