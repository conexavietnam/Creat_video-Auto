import { VideoProvider } from './types.ts';
import { mockProvider } from './mock.ts';
import { veoProvider } from './veo.ts';
import { klingProvider } from './kling.ts';
import { flowProvider } from './flow.ts';

const registry: VideoProvider[] = [veoProvider, klingProvider, flowProvider, mockProvider];

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
