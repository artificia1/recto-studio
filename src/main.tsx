import { render } from 'preact';
import { App } from './components/App';
import './style.css';

const mountPoint = document.getElementById('root');
if (mountPoint) {
  render(<App />, mountPoint);
  console.log('Recto Publishing Studio (TypeScript + Preact TSX) loaded.');
}
