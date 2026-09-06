import { I18nProvider as LinguiProvider, type TransRenderProps } from '@lingui/react';
import type { PropsWithChildren } from 'react';
import { Text } from 'react-native';
import { i18n } from './i18n';

function DefaultComponent(props: TransRenderProps) {
  return <Text>{props.children}</Text>;
}

export function I18nProvider({ children }: PropsWithChildren) {
  return (
    <LinguiProvider i18n={i18n} defaultComponent={DefaultComponent}>
      {children}
    </LinguiProvider>
  );
}
