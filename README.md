# Bosque Babylon (starter)

Starter minimal para un juego 3D de exploración con Babylon.js:
- Vite + TypeScript
- WASD + correr (Shift)
- Salto (Space) + gravedad
- Colisiones simples 2D (colliders placeholder) para árboles/props
- Interacción con objetos (E) por raycast
- Terreno procedural + fog lúgubre
- Segment streaming (placeholders) + lluvia simple

## Ejecutar
```bash
npm install
npm run dev
```

## Assets
Poné tus assets en `public/assets/...` y luego reemplazamos placeholders por cargas `.glb` con:
`SceneLoader.AppendAsync("/assets/models/", "tuMapa.glb", scene);`
