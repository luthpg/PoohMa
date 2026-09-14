import type { Infer, Validator } from "convex/values";
import type { ReactElement } from "react";

export interface EmailTemplateDefinition<
  // biome-ignore lint/suspicious/noExplicitAny: Convex Validator variance
  P extends Validator<any, any, any>,
  K extends string = string,
> {
  key: K;
  props: P;
  subject: (props: Infer<P>) => string;
  Component: (props: Infer<P>) => ReactElement;
}

export type AnyEmailTemplateDefinition = EmailTemplateDefinition<
  // biome-ignore lint/suspicious/noExplicitAny: Convex Validator variance
  Validator<any, any, any>,
  string>;

export function defineEmailTemplate<
  // biome-ignore lint/suspicious/noExplicitAny: Convex Validator variance
  P extends Validator<any, any, any>,
  K extends string,
>(definition: EmailTemplateDefinition<P, K>): EmailTemplateDefinition<P, K> {
  return definition;
}
