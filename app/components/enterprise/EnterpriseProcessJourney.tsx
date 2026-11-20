'use client';

import type { KeyboardEvent, RefObject } from 'react';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { EnterpriseButton } from './EnterprisePrimitives';

type EnterpriseProcessJourneyProps = {
  steps: readonly string[];
  currentStage: number;
  edges: { before: boolean; after: boolean };
  viewportRef: RefObject<HTMLDivElement | null>;
  onViewportScroll: () => void;
  onViewportKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onScrollDirection: (direction: number) => void;
  onStageSelect: (index: number) => void;
};

export function EnterpriseProcessJourney({
  steps, currentStage, edges, viewportRef, onViewportScroll,
  onViewportKeyDown, onScrollDirection, onStageSelect,
}: EnterpriseProcessJourneyProps) {
  return (
    <section className="process-strip" aria-label="Cadeia operacional">
      <div className="process-label">
        <Layers size={17} aria-hidden="true" />
        <span>ETAPAS DO PROCESSO</span>
      </div>
      <div className={'chain-scroll ' + (edges.before ? 'has-before ' : '') + (edges.after ? 'has-after' : '')}>
        <EnterpriseButton
          type="button" className="chain-navigation chain-previous"
          aria-label="Ver etapas anteriores" hidden={!edges.before}
          onClick={() => onScrollDirection(-1)}
        >
          <ChevronLeft size={16} />
        </EnterpriseButton>
        <div
          className="chain-viewport"
          ref={viewportRef}
          tabIndex={0}
          aria-label="Etapas da cadeia; use as setas para navegar"
          onScroll={onViewportScroll}
          onKeyDown={onViewportKeyDown}
        >
          <div className="process-stages">
            {steps.map((step, index) => {
              const stageClass = index === currentStage
                ? 'current' : index > currentStage ? 'subsequent' : '';
              const number = String(index + 1).padStart(2, '0');
              return index < 5 ? (
                <EnterpriseButton
                  type="button" key={step} data-stage-index={index}
                  className={stageClass}
                  aria-current={index === currentStage ? 'location' : undefined}
                  onClick={() => onStageSelect(index)}
                >
                  <span className="step-number">{number}</span>
                  {step}
                  <ChevronRight className="stage-divider" size={13} aria-hidden="true" />
                </EnterpriseButton>
              ) : (
                <span key={step} className={'stage-unavailable ' + stageClass}
                  aria-disabled="true" title="Transição operacional não validada nesta jornada">
                  <span className="step-number">{number}</span>
                  {step}
                  {index < steps.length - 1 && <ChevronRight className="stage-divider" size={13} aria-hidden="true" />}
                </span>
              );
            })}
          </div>
        </div>
        <EnterpriseButton
          type="button" className="chain-navigation chain-next"
          aria-label="Ver próximas etapas" hidden={!edges.after}
          onClick={() => onScrollDirection(1)}
        >
          <ChevronRight size={16} />
        </EnterpriseButton>
      </div>
    </section>
  );
}
