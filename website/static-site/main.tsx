import { createRoot } from 'react-dom/client';
import App from '../app/page';
import '../app/globals.css';
import './test.css';

createRoot(document.getElementById('root')!).render(<App />);
