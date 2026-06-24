async function main() {
  const res = await fetch('http://localhost:3000/api/seed/test-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken: 'setup_initial_bootstrap_token_change_immediately_after_first_use_12345678' }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => console.error('Error:', e.message));
