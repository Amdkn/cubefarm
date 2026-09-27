import { Game } from './world/Game';
import { HUD } from './ui/HUD';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';

export function App() {
  return (
    <>
      <Game />
      <HUD />
      <Overlays />
      <StartScreen />
    </>
  );
}
