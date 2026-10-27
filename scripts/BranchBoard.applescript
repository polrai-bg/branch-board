on repoRoot()
  set appPOSIX to POSIX path of (path to me)
  return do shell script "dirname " & quoted form of appPOSIX
end repoRoot

on run
  set root to repoRoot()
  do shell script quoted form of (root & "/scripts/open-board.sh") & " open"
end run

on open location theURL
  set root to repoRoot()
  do shell script quoted form of (root & "/scripts/open-board.sh") & " start"
end open location
