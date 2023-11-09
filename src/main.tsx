import { render } from 'preact';
import { App } from './components/App';
import './style.css';

const mountPoint = document.getElementById('root');
if (mountPoint) {
  render(<App />, mountPoint);
  console.log('Papercut Publishing Studio (TypeScript + Preact TSX) loaded.');
}
