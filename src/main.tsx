import {render} from 'preact';
import {App} from './ui/App';
import {initializeStore} from './ui/state';
import './ui/app.css';
const root=document.getElementById('app');if(root){render(<App/>,root);void initializeStore();}
