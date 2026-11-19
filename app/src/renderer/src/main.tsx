import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PriceCheckApp } from './PriceCheckApp'
import './styles.css'

// одно и то же приложение обслуживает два окна: основное и прайс-чек (#pricecheck)
const Root = location.hash === '#pricecheck' ? PriceCheckApp : App
createRoot(document.getElementById('root')!).render(<Root />)
