import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PriceCheckApp } from './PriceCheckApp'
import { StashApp } from './StashApp'
import './styles.css'

// одно и то же приложение обслуживает три окна: основное, прайс-чек (#pricecheck) и оверлей склада (#stash)
const Root = location.hash === '#pricecheck' ? PriceCheckApp : location.hash === '#stash' ? StashApp : App
createRoot(document.getElementById('root')!).render(<Root />)
