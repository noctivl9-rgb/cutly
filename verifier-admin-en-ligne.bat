@echo off
rem CUTLY - diagnostic de connexion de l'administrateur en ligne (lecture seule, ne modifie rien).
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  CUTLY - verification de la connexion administrateur
echo  ---------------------------------------------------
echo  Il vous faut : la chaine de connexion Netlify (Base de donnees, production, Connect,
echo  ligne "Read and write"), votre e-mail, votre mot de passe et le code Google Authenticator.
echo.
call npm run check:admin:netlify
echo.
pause
