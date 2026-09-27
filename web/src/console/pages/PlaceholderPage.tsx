/**
 * A page that has not been built yet.
 *
 * It says so plainly, names the pillar it will serve and the build phase it lands in.
 * A designed "not built yet" is honest; a half-built screen full of zeros is not, and
 * in front of an evaluator the second is much worse.
 */

import { Hammer } from 'lucide-react';
import { Card, EmptyState, Chip } from '../../shared/ui';

export function PlaceholderPage({ title, pillar, phase }: {
  title: string; pillar: string; phase: string;
}) {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">{title}</h2>
          <div className="page__sub">{pillar}</div>
        </div>
        <div className="page__actions">
          <Chip tone="warning">Not yet built</Chip>
        </div>
      </div>

      <Card>
        <EmptyState
          icon={<Hammer aria-hidden />}
          title={`${title} is scheduled for ${phase}`}
          body={`This surface is specified in docs/06-CONSOLE-SPEC.md and will be populated from the seeded history. Nothing here is a placeholder value — the page is simply not built, and says so rather than showing zeros.`}
        />
      </Card>
    </div>
  );
}
