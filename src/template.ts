import html from '../templates/todo/index.html?raw';
import css from '../templates/todo/styles.css?raw';
import app from '../templates/todo/app.js?raw';
import adapter from '../templates/todo/data-store.js?raw';
import csv from '../templates/todo/fixtures/todos.csv?raw';

export const templateFiles: Record<string, string> = {
  'index.html': html,
  'styles.css': css,
  'app.js': app,
  'data-store.js': adapter,
  'fixtures/todos.csv': csv,
};
