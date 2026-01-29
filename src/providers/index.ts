import { BaseProvider, ProviderError } from './base.provider.js';
import { stripeProvider } from './stripe.provider.js';
import { paypalProvider } from './paypal.provider.js';

const providers: Record<string, BaseProvider> = {
  stripe: stripeProvider,
  paypal: paypalProvider,
};

export function getProvider(name: string): BaseProvider {
  const provider = providers[name.toLowerCase()];
  if (!provider) {
    throw new ProviderError(
      `Unknown provider: ${name}`,
      'UNKNOWN_PROVIDER',
      name
    );
  }
  return provider;
}

export function getSupportedProviders(): string[] {
  return Object.keys(providers);
}

export { BaseProvider, ProviderError } from './base.provider.js';
export { stripeProvider } from './stripe.provider.js';
export { paypalProvider } from './paypal.provider.js';
