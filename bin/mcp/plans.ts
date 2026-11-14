import { randomUUID } from 'node:crypto';
import type { ProjectState } from '../../src/types';
import { limits, sha256, type PublishingWorkspace } from './workspace';
import { confirmProjectRevision, validatePublishingProject, type LoadedProject } from './publication';

const expiryMs = 15 * 60_000;
const maxPlans = 4;
type Plan = { source: string; revision: string; bytes: Uint8Array; expires: number; inputs: { file: string; revision: string }[] };

export class DraftPlans {
  private readonly items = new Map<string, Plan>();

  stage(project: LoadedProject, draft: ProjectState, inputs: Plan['inputs'] = []) {
    const bytes = Buffer.from(JSON.stringify(draft));
    if (bytes.byteLength > limits.project) throw new Error('The draft exceeds the project size limit.');
    const now = Date.now();
    for (const [id, plan] of this.items) if (plan.expires <= now) this.items.delete(id);
    while (this.items.size >= maxPlans) this.items.delete(this.items.keys().next().value!);
    const planId = randomUUID();
    this.items.set(planId, { source: project.file, revision: project.revision, inputs, bytes, expires: now + expiryMs });
    return { planId, sourceRevision: project.revision, expiresInSeconds: expiryMs / 1000 };
  }

  private async current(workspace: PublishingWorkspace, planId: string) {
    const plan = this.items.get(planId);
    if (!plan || plan.expires <= Date.now()) { this.items.delete(planId); throw new Error('The preview expired or was already saved. Run the preview again.'); }
    await confirmProjectRevision(workspace, plan.source, plan.revision);
    for (const input of plan.inputs) {
      const bytes = await workspace.read(input.file, ['.xlf', '.xliff'], limits.exchange);
      if (sha256(bytes) !== input.revision) throw new Error('The translation exchange changed. Run the preview again.');
    }
    return plan;
  }

  async preview(workspace: PublishingWorkspace, planId: string): Promise<LoadedProject & { inputs: Plan['inputs'] }> {
    const plan = await this.current(workspace, planId);
    return { file: plan.source, revision: plan.revision, source: validatePublishingProject(Buffer.from(plan.bytes)), inputs: plan.inputs };
  }

  async save(workspace: PublishingWorkspace, planId: string, output: string) {
    workspace.assertWritable();
    const plan = await this.current(workspace, planId);
    const result = await workspace.write(output, '.recto', plan.bytes);
    this.items.delete(planId);
    return result;
  }

  async offer(workspace: PublishingWorkspace, planId: string, output: string) {
    const plan = await this.current(workspace, planId);
    if (!/^recto-proposal-[a-zA-Z0-9]{20}\.rectoproposal$/.test(output.split('/').at(-1) || '')) {
      throw new Error('Use the proposal filename shown in the desktop review dialog.');
    }
    const bytes = Buffer.from(`{"format":"recto-proposal","version":1,"sourceRevision":"${plan.revision}","draft":${plan.bytes.toString()}}`);
    if (bytes.length > limits.project) throw new Error('This proposal exceeds 32 MiB.');
    return workspace.write(output, '.rectoproposal', bytes);
  }
}
