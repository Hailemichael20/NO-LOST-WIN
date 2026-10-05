import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        registration.update().catch((error) => {
          console.error('Service worker update check failed:', error)
        })

        const checkForUpdates = () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch((error) => {
              console.error('Service worker update check failed:', error)
            })
          }
        }
        document.addEventListener('visibilitychange', checkForUpdates)

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