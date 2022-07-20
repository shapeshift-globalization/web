import { Center } from '@chakra-ui/react'
import { AnimatePresence, HTMLMotionProps } from 'framer-motion'
import { ReactNode } from 'react'
import { Route } from 'Routes/helpers'
import { CircularProgress } from 'components/CircularProgress/CircularProgress'
import { Text } from 'components/Text'

import { PageTransition } from './PageTransition'

type PageProps = {
  children: ReactNode
  loading?: boolean
  error?: boolean
  renderError?: () => ReactNode
  renderLoading?: () => ReactNode
  route?: Route
} & HTMLMotionProps<'div'>

export const Page: React.FC<PageProps> = ({
  children,
  loading,
  error,
  renderLoading = () => null,
  renderError = () => null,
  route,
  ...rest
}: PageProps) => {
  return (
    <AnimatePresence exitBeforeEnter initial>
      <PageTransition style={{ flex: 1 }} {...rest}>
        {error && !loading ? renderError() : loading ? renderLoading() : children}
      </PageTransition>
    </AnimatePresence>
  )
}

Page.defaultProps = {
  renderLoading: () => (
    <Center width='full' height='100%'>
      <CircularProgress isIndeterminate />
    </Center>
  ),
  renderError: () => (
    <Center width='full' height='100%'>
      <Text translation='common.noResultsFound' />
    </Center>
  ),
}
