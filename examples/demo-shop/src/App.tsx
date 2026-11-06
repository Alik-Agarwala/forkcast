import { useEffect, useState } from 'react';
import { Experiment, Feature, useFlag, useForkcast, useForkcastReady, usePayload, useTrack, useTreatment, Variant } from 'forkcast/react';

const PRODUCTS = [
  { id: 'ethiopia', name: 'Ethiopia Yirgacheffe', notes: 'Jasmine · bergamot · honey', price: 18, hue: 28 },
  { id: 'colombia', name: 'Colombia Huila', notes: 'Caramel · red apple · cocoa', price: 16, hue: 18 },
  { id: 'kenya', name: 'Kenya Nyeri AA', notes: 'Blackcurrant · grapefruit', price: 21, hue: 350 },
  { id: 'brazil', name: 'Brazil Cerrado', notes: 'Hazelnut · milk chocolate', price: 14, hue: 35 },
];

type Product = (typeof PRODUCTS)[number];
const COUNTRIES = ['IN', 'US', 'GB', 'DE', 'CA', 'BR', 'JP'];

function UserBar() {
  const fc = useForkcast();
  const user = fc.getUser();
  const [country, setCountry] = useState(String(user.country ?? 'IN'));
  return (
    <div className="userbar">
      <span>
        Signed in as <code>{String(user.id).slice(0, 18)}</code>
      </span>
      <label>
        Country{' '}
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            localStorage.setItem('demo:country', e.target.value);
            fc.setUser({ ...fc.getUser(), country: e.target.value });
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          const id = 'user-' + Math.random().toString(36).slice(2, 8);
          localStorage.setItem('demo:userId', id);
          fc.setUser({ ...fc.getUser(), id, anonymous: false });
        }}
      >
        Be a new random user
      </button>
    </div>
  );
}

function Hero() {
  // Payloads let you change copy/config per treatment without a deploy.
  const copy = usePayload<{ headline: string; cta: string }>('hero-headline') ?? { headline: 'Fresh coffee, delivered weekly', cta: 'Shop beans' };
  return (
    <section className="hero">
      <h1>{copy.headline}</h1>
      <p>Small-batch roasts from four origins, roasted on Monday and at your door by Thursday.</p>
      <a href="#shop" className="primary">
        {copy.cta}
      </a>
    </section>
  );
}

function BuyButtons({ product, onAdd }: { product: Product; onAdd: (p: Product) => void }) {
  const track = useTrack();
  // Declarative branching on the treatment. Unknown/off -> the C branch.
  return (
    <Experiment name="new-checkout">
      <Variant name="C">
        <button className="secondary" onClick={() => onAdd(product)}>
          Add to cart
        </button>
      </Variant>
      <Variant name="T1">
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              track('purchase', { value: product.price, sku: product.id });
              alert(`Bought ${product.name} with one click!`);
            }}
          >
            Buy now · 1-click
          </button>
          <button className="secondary" onClick={() => onAdd(product)}>
            + Cart
          </button>
        </div>
      </Variant>
      <Variant name="T2">
        <button className="secondary" onClick={() => onAdd(product)}>
          Add to cart
        </button>
      </Variant>
    </Experiment>
  );
}

function Treatments() {
  const fc = useForkcast();
  const ready = useForkcastReady();
  useTreatment('new-checkout'); // re-render on changes
  return (
    <aside className="debug">
      <h3>What this user sees {ready ? '' : '(loading…)'}</h3>
      <table>
        <tbody>
          {fc.getExperiments().map((e) => {
            const ev = fc.peek(e.key);
            return (
              <tr key={e.key}>
                <td>
                  <code>{e.key}</code>
                </td>
                <td>
                  <b>{ev.variant}</b>
                </td>
                <td className="muted">{ev.reason.replace(/_/g, ' ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">
        Environment <b>{fc.getEnvironment()}</b>. Toggle anything in the dashboard and this updates instantly.
      </p>
    </aside>
  );
}

export function App() {
  const dark = useFlag('dark-mode');
  const holiday = useFlag('holiday-theme');
  const checkout = useTreatment('new-checkout');
  const track = useTrack();
  const [cart, setCart] = useState<Product[]>([]);
  const total = cart.reduce((s, p) => s + p.price, 0);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const add = (p: Product) => {
    setCart((c) => [...c, p]);
    track('add_to_cart', { value: p.price, sku: p.id });
  };
  const checkoutNow = () => {
    track('purchase', { value: total, items: cart.length });
    alert(`Order placed: $${total}`);
    setCart([]);
  };

  return (
    <div className={holiday ? 'holiday' : ''}>
      <Feature flag="free-shipping-banner">
        <div className="banner">Free shipping on orders over $30 🚚</div>
      </Feature>
      <header className="nav">
        <strong>{holiday ? '🎄 ' : '☕ '}Forkcast Coffee Co.</strong>
        <span className="cart">
          Cart · {cart.length} · ${total}
          {cart.length > 0 && checkout !== 'T2' && (
            <button className="primary small" onClick={checkoutNow}>
              Checkout
            </button>
          )}
        </span>
      </header>
      <UserBar />
      <Hero />
      <main className="layout" id="shop">
        <div className="grid">
          {PRODUCTS.map((p) => (
            <article key={p.id} className="product">
              <div className="art" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 55% 42%), hsl(${p.hue + 25} 45% 22%))` }} />
              <h3>{p.name}</h3>
              <p className="muted">{p.notes}</p>
              <div className="price">${p.price}</div>
              <BuyButtons product={p} onAdd={add} />
            </article>
          ))}
        </div>
        <Treatments />
      </main>
      {checkout === 'T2' && cart.length > 0 && (
        <div className="sticky">
          <span>
            {cart.length} item(s) · <b>${total}</b>
          </span>
          <button className="primary" onClick={checkoutNow}>
            Checkout now →
          </button>
        </div>
      )}
    </div>
  );
}
