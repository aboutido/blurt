const form = document.getElementById('join');
const pin = document.getElementById('pin');
pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, '').slice(0, 6); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (pin.value.length !== 6) { pin.focus(); return; }
  location.href = `/play?pin=${pin.value}`;
});
