/**
 * Initializes localization and mounts the React provider stack.
 */

import './assets/styles/index.scss'

import { App as AntdApp } from 'antd'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App'
import AntdProvider from './context/AntdProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { initializeI18n } from './i18n'
import store from './store'

/** Mounts the application only after i18next resources are ready. */
const mountApplication = async (): Promise<void> => {
  await initializeI18n()
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Renderer root element was not found.')
  createRoot(rootElement).render(
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <AntdApp>
            <App />
          </AntdApp>
        </AntdProvider>
      </ThemeProvider>
    </Provider>,
  )
}

void mountApplication()
