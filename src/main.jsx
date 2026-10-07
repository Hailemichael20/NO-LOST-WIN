import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('/sw.js', window.location.origin).href
    const serviceWorkerOptions = { scope: '/', updateViaCache: 'none' }
    navigator.serviceWorker.register(serviceWorkerUrl, serviceWorkerOptions)
      .then(async (registration) => {
        const checkForUpdates = async () => {
          try {
            const worker = registration.active || registration.waiting || registration.installing
            if (worker && worker.scriptURL !== serviceWorkerUrl) {
              await registration.unregister()
              await navigator.serviceWorker.register(serviceWorkerUrl, serviceWorkerOptions)
              return
            }
            if (registration.active?.state === 'activated') await registration.update()
          } catch (error) {
            console.error('Service worker update check failed:', error)
          }
        }

        await checkForUpdates()
        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') void checkForUpdates()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        const hadController = Boolean(navigator.serviceWorker.controller)
        const reloadOnUpdate = () => {
          if (hadController) window.location.reload()
        }
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnUpdate)
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error)
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)