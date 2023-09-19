import { Accordion, MenuDivider, MenuGroup } from '@chakra-ui/react'
import type { SessionTypes } from '@walletconnect/types'
import { useWalletConnectV2 } from 'plugins/walletConnectToDapps/WalletConnectV2Provider'
import { useMemo } from 'react'
import { useTranslate } from 'react-polyglot'

import { WalletConnectButtons } from './ConnectDapp'
import { Session } from './Session'

export const DappHeaderMenuSummaryV2 = () => {
  const translate = useTranslate()

  const { sessionsByTopic, web3wallet } = useWalletConnectV2()

  const sessions = useMemo(() => Object.values(sessionsByTopic), [sessionsByTopic])

  const { connectedSessions, expiredSessions } = useMemo(() => {
    const nowTtl = Date.now() / 1000
    return sessions.reduce<{
      connectedSessions: SessionTypes.Struct[]
      expiredSessions: SessionTypes.Struct[]
    }>(
      (acc, session) => {
        if (!session) return acc
        if (session.expiry < nowTtl) {
          acc.expiredSessions.push(session)
        } else {
          acc.connectedSessions.push(session)
        }
        return acc
      },
      { connectedSessions: [], expiredSessions: [] },
    )
  }, [sessions])

  if (!sessions.length || !web3wallet) return null

  return (
    <>
      {connectedSessions.length > 0 && (
        <MenuGroup
          title={translate('plugins.walletConnectToDapps.header.connectedDapp')}
          ml={3}
          color='text.subtle'
        >
          <Accordion allowToggle defaultIndex={0} variant='default'>
            {connectedSessions.map(session => (
              <Session key={session.topic} session={session} />
            ))}
          </Accordion>
        </MenuGroup>
      )}
      {connectedSessions.length > 0 && expiredSessions.length > 0 && <MenuDivider />}
      {expiredSessions.length > 0 && (
        <MenuGroup
          title={translate('plugins.walletConnectToDapps.header.staleDapp')}
          ml={3}
          color='text.subtle'
        >
          <Accordion allowToggle defaultIndex={0} variant='default'>
            {expiredSessions.map(session => (
              <Session key={session.topic} session={session} />
            ))}
          </Accordion>
        </MenuGroup>
      )}
      <MenuDivider />
      <WalletConnectButtons m={4} />
    </>
  )
}
