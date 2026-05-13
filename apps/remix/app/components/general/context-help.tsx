import { type ReactNode } from 'react';

import { HelpCircleIcon } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@nexasign/ui/primitives/tooltip';

type ContextHelpProps = {
  content: ReactNode;
  className?: string;
};

export const ContextHelp = ({ content, className }: ContextHelpProps) => {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={
            className ??
            'inline-flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          }
          aria-label="Hilfe anzeigen"
        >
          <HelpCircleIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs p-3 text-sm leading-6">{content}</TooltipContent>
    </Tooltip>
  );
};
