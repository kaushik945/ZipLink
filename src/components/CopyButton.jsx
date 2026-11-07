import { useState } from 'react';
import Icon from './Icon';
export default function CopyButton({ text }) {
  const [feedback, setFeedback] = useState(null);
  const status = feedback?.text === text ? feedback.message : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({ text, message: 'Copied!' });
    } catch {
      setFeedback({ text, message: 'Copy failed. Select the link to copy manually.' });
    }
  }
  return (
    <span className="copy-wrap">
      <button className="button button-secondary" onClick={copy} aria-label="Copy short link">
        <Icon name={status === 'Copied!' ? 'check' : 'copy'} size={16} />
        {status === 'Copied!' ? status : 'Copy'}
      </button>
      <span className="copy-feedback" role="status">
        {status && status !== 'Copied!' ? status : ''}
      </span>
    </span>
  );
}
