Feature: The Screens plugin: sessions, runs in a screen, shells
  Once the plugin is activated and installed, every page carries the Sessions button, a workspace
  page offers "Run in a screen", every project row carries the SHELL menu, and the Plugins page
  lists the plugin with its four steps. Each of them is a switch in the plugin's settings file; these
  scenarios hold with the switches as they ship (all on).

  Scenario: The Sessions button opens the list of sessions
    Given I am on "/"
     Then I should see "Sessions"
     When I go to "/screens/runs"
     Then I should see "Sessions"
      And I should see "Remove ended sessions"
      And the element "#sessions-list-body" should be displayed

  Scenario: The list of sessions answers as a fragment, without the page
    Given I am on "/fragments/p/screens/runs/list"
     Then I should see "running"
      And I should see "ended"

  Scenario: A workspace page offers "Run in a screen" with the commands of the folder
    Given I am on "/dev"
     Then I should see "Run in a screen"
     When I go to "/fragments/p/screens/run-form?workspace=dev"
     Then I should see "Run in a screen · dev"
      And I should see "In a screen session"
      And I should see "In the page"

  Scenario: A project row offers the SHELL menu
    Given I am on "/dev"
     Then the element ".act-menu-shell" should be displayed
      And I should see "SHELL"

  Scenario: Stopping a session that is not running is refused, and names no other session
    When I post "/actions/p/screens/stop" with '{"session":"zz-not-a-session"}'
    Then the action response should contain "no such session is running"

  Scenario: A command that is not a cmd file of the folder is refused
    When I post "/actions/p/screens/run" with '{"workspace":"dev","script":"../core/scripts/install.sh"}'
    Then the action response should contain "Unknown command"

  Scenario: The plugin is listed on the Plugins page
    Given I am on "/settings/plugins"
     Then I should see "Screens and terminals"
      And I should see "@webship.co/workspace-screens"

  Scenario: The AI Agents folder lists the agent the plugin ships
    Given I am on "/ai-agents"
     Then I should see "screens-runner"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills"
     Then I should see "screens-sessions"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands"
     Then I should see "screens-list"

  Scenario: The AI Prompts folder lists the prompt the plugin ships
    Given I am on "/ai-prompts"
     Then I should see "screens-run-and-follow"
