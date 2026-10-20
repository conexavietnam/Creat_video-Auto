import { VideoProvider } from './types.ts';
import { mockProvider } from './mock.ts';
import { veoProvider } from './veo.ts';
import { klingProvider } from './kling.ts';
import { flowProvider } from './flow.ts';
import { isProviderEnabled } from '../providerConfig.ts';

const ADMIN_DISABLED_REASON = 'Đã bị quản trị viên tắt';

function withAdminSwitch(provider: VideoProvider): VideoProvider {
  const baseAvailable = provider.available;
  const baseReason = provider.unavailableReason;
  Object.defineProperty(provider, 'available', {
    get: () => baseAvailable && isProviderEnabled(provider.id),
    enumerable: true,
  });
  Object.defineProperty(provider, 'unavailableReason', {
    get: () => (!baseAvailable ? baseReason : isProviderEnabled(provider.id) ? undefined : ADMIN_DISABLED_REASON),
    enumerable: true,
  });
  return provider;
}

const registry: VideoProvider[] = [veoProvider, klingProvider, flowProvider, mockProvider].map(withAdminSwitch);

export function listProviders(): VideoProvider[] {
  return registry;
}

export function getProvider(id: string): VideoProvider | undefined {
  return registry.find(p => p.id === id);
}

export function publicProvider(p: VideoProvider) {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    credentialHint: p.credentialHint,
    available: p.available,
    unavailableReason: p.available ? undefined : p.unavailableReason,
    capabilities: p.capabilities,
  };
}

export * from './types.ts';
