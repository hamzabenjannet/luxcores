# Align the Web and Godot Clients Before M4

Session of 2026-10-18, after commit `80060ac` (M3 in the sim and the first Godot client). The text of the request is verbatim, and the two answers are the options the owner picked.

> analyse the whole repo and consolidate the woking game on godot with the js mvp, now the gotod project is at milestone m3. we need to have both versions alligned befor continuing to m4. make sure that the js mvp work and able to connect to the server, and that the server is able to render the js version. so the stand alone js could be played by an user vs a test bot or a bot vs  bot, the js version server from the backend server could be lpayed by humans and bots, and the godot version is fully imlemented till M3. it is better to consolidat the stand alone version into the backend like so we keep updating only the server with it's js version rendering to have a referance point of the mvp and continu porting it to the godot. ask questions when unsure.

## Answers to the Questions Asked

| Question | Answer |
|---|---|
| What should happen to the stand-alone JS mode, where the browser runs its own sim with no server? | Server-only page (Recommended): the page always plays through the backend, and the in-browser sim loop goes away |
| How should the hero parts of M3 (`heroMove`, `heroAttack`) be treated in Godot, given that no hero exists before M5? | Wire it, test with fixtures (Recommended) |
